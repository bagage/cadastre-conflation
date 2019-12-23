#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import datetime
import http.cookiejar
import logging
import re
import urllib.request
import zlib
from collections import Counter
from contextlib import closing

import requests
from bs4 import BeautifulSoup, SoupStrainer

from .db import City, Db

LOG = logging.getLogger(__name__)


class Batimap(object):
    IGNORED_BUILDINGS = ["church"]
    NO_BUILDING_CITIES = ["55139", "55039", "55307", "55050", "55239"]
    cadastre_src2date_regex = re.compile(r".*(cadastre)?.*(20\d{2}).*(?(1)|cadastre).*")

    def __init__(self, db: Db, overpass):
        self.db = db
        self.overpass = overpass

    def stats(self, department=None, names_or_insees=[], force=False, refresh_cadastre_state=False):
        if department:
            cities = self.db.get_cities_for_department(department)
        else:
            cities = [self.db.get_city_for_insee(x) or self.db.get_city_for_name(x) for x in names_or_insees]

        if refresh_cadastre_state:
            if department:
                depts = [department]
            else:
                depts = list(set([c.department for c in cities]))
            list(self.update_departments_raster_state(depts))

        for city in cities:
            yield self.fetch_osm_data(city, force)

    def compute_date_for_undated_cities(self, departments):
        # we do not store building changeset timestamp in database, so we need to ask Overpass for cities which such
        # buildings. For now, only ask for cities with a majority of unknown buildings, but we could whenever there is one
        unknowns = [c.insee for c in self.db.get_undated_cities(departments)]
        LOG.info(f"Using overpass for {len(unknowns)} unknown cities: {unknowns}")
        for idx, _ in enumerate(self.stats(names_or_insees=unknowns, force=True)):
            yield (idx + 1, len(unknowns))

    def update_departments_raster_state(self, departments):
        url = "https://www.cadastre.gouv.fr/scpc/rechercherPlan.do"
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        r = op.open(url)
        csrf_token = r.read().split(b"CSRF_TOKEN=")[1].split(b'"')[0].decode("utf-8")
        op.addheaders = [("Accept-Encoding", "gzip")]

        LOG.info(f"Récupération des infos cadastrales pour les départements {departments}")
        for idx, d in enumerate(departments):
            LOG.info(f"Récupération des infos cadastrales pour le département {d}")
            if len(self.db.get_cities_for_department(d)) > 0 and self.db.get_raster_cities_count(d) == 0:
                LOG.info(f"Le département {d} ne contient que des communes vectorisées, rien à faire")
                continue
            tuples = []
            d = f"{d}"
            r2 = op.open(
                f"https://www.cadastre.gouv.fr/scpc/listerCommune.do?CSRF_TOKEN={csrf_token}"
                f"&codeDepartement={d.zfill(3)}&libelle=&keepVolatileSession=&offset=5000"
            )
            cities = SoupStrainer("tbody", attrs={"class": "parcelles"})
            fr = BeautifulSoup(zlib.decompress(r2.read(), 16 + zlib.MAX_WBITS), "lxml", parse_only=cities)
            LOG.debug(f"Query result: {fr.prettify()}")
            for e in fr.find_all("tbody"):
                y = e.find(title="Ajouter au panier")
                if not y:
                    continue

                # y.get('onclick') structure: "ajoutArticle('CL098','VECT','COMU');"
                (_, code_commune, _, format_type, _, _, _) = y.get("onclick").split("'")

                # e.strong.string structure: "COBONNE (26400) "
                commune_cp = e.strong.string
                nom_commune = commune_cp[:-9]

                dept = d.zfill(2)
                start = len(dept) - 5
                insee = dept + code_commune[start:]
                is_raster = format_type == "IMAG"

                name = self.db.get_osm_city_name_for_insee(insee)
                if not name:
                    LOG.error(f"Cannot find city with insee {insee}, did you import OSM data for this department?")
                    continue

                city = self.db.get_city_for_insee(insee)
                if not city:
                    city = City()
                    city.insee = insee
                    self.db.session.add(city)
                city.department = dept
                city.name = name
                city.name_cadastre = f"{code_commune}-{nom_commune}"
                city.import_date = "raster" if is_raster else city.import_date or "never"
                city.is_raster = is_raster
            LOG.debug(f"Inserting {len(tuples)} cities in database…")
            self.db.session.commit()
            yield idx + 1

    def fetch_departments_osm_state(self, departments):
        LOG.info(f"Récupération du statut OSM pour les départements {departments}")
        for idx, d in enumerate(departments):
            LOG.info(f"Récupération du statut OSM pour le département {d}")
            url = "https://cadastre.openstreetmap.fr"
            dept = d.zfill(3)
            r = requests.get(f"{url}/data/{dept}/")
            bs = BeautifulSoup(r.content, "lxml")
            refresh_tiles = []

            cities = self.db.get_cities_for_department(d)
            no_cadastre_cities = [c for c in cities]
            cities_name_cadastre = [c.name_cadastre for c in cities]

            for e in bs.select("tr"):
                osm_data = e.select("td > a")
                if len(osm_data):
                    osm_data = osm_data[0].text
                    if not osm_data.endswith("simplifie.osm") or "-extrait-" in osm_data:
                        continue
                    name_cadastre = "-".join(osm_data.split("-")[:-2])
                    date_cadastre = datetime.datetime.strptime(e.select("td:nth-of-type(3)")[0].text.strip(), "%d-%b-%Y %H:%M")

                    c = cities[cities_name_cadastre.index(name_cadastre)]
                    no_cadastre_cities.remove(c)
                    if c.date_cadastre != date_cadastre:
                        LOG.info(f"Cadastre changed changed for {c} from {c.date_cadastre} to {date_cadastre}")
                        refresh_tiles.append(c.insee)
                        c.date_cadastre = date_cadastre

            for c in no_cadastre_cities:
                # removing date for cities that are not listed on the website anymore
                c.date_cadastre = None

            self.db.session.commit()

            for insee in refresh_tiles:
                self.clear_tiles(insee)
            yield idx + 1

    def josm_data(self, insee):
        c = self.db.get_city_for_insee(insee)
        if not c:
            return None

        base_url = f"https://cadastre.openstreetmap.fr/data/{c.department.zfill(3)}/{c.name_cadastre}-houses-"
        bbox = self.db.get_city_bbox(insee)

        # force refreshing city latest import date
        city = self.fetch_osm_data(c, True)
        return {
            "buildingsUrl": base_url + "simplifie.osm",
            "segmententationPredictionssUrl": base_url + "prediction_segmente.osm",
            "bbox": [bbox.xmin, bbox.xmax, bbox.ymin, bbox.ymax],
            "date": city.import_date,
        }

    __total_pdfs_regex = re.compile(r".*coupe la bbox en (\d+) \* (\d+) \[(\d+) pdfs\]$")
    __pdf_progression_regex = re.compile(r".*\d+-(\d+)-(\d+).pdf$")

    def fetch_cadastre_data(self, city):
        if not city or not city.name_cadastre:
            return

        # force refresh if cadastre data is too old
        force = city.date_cadastre is not None and not city.is_josm_ready()

        url = "https://cadastre.openstreetmap.fr"
        dept = city.department.zfill(3)
        r = requests.get(f"{url}/data/{dept}/")
        bs = BeautifulSoup(r.content, "lxml")

        if not force:
            archive = f"{city.name_cadastre.upper()}-houses-simplifie.osm"
            for e in bs.find_all("tr"):
                if archive in [x.text for x in e.select("td:nth-of-type(2) a")]:
                    date = e.select("td:nth-of-type(3)")[0].text.strip()
                    LOG.info(f"{city.name_cadastre} was already generated at {date}, no need to regenerate it!")
                    return

        data = {"dep": dept, "type": "bati", "force": str(force).lower(), "ville": city.name_cadastre}

        # otherwise we invoke Cadastre generation
        with closing(requests.post(url, data=data, stream=True)) as r:
            (total_y, total) = (0, 0)
            for line in r.iter_lines(decode_unicode=True):
                match = self.__total_pdfs_regex.match(line)
                if match:
                    total_y = int(match.groups()[1])
                    total = int(match.groups()[2])
                match = self.__pdf_progression_regex.match(line)
                if match:
                    x = int(match.groups()[0])
                    y = int(match.groups()[1])
                    current = x * total_y + y
                    msg = f"{city} - {current}/{total} ({current * 100.0 / total:.2f}%)" if total > 0 else f"{current}"
                    LOG.info(msg)
                    yield current * 100 / total
                if "Termin" in line:
                    current = total
                    msg = f"{city} - {current}/{total} ({current * 100.0 / total:.2f}%)" if total > 0 else f"{current}"
                    LOG.info(msg)
                    yield 100
                elif "ERROR:" in line or "ERREUR:" in line:
                    LOG.error(line)
                    # may happen when cadastre.gouv.fr is in maintenance mode
                    raise Exception(line)

    def clear_tiles(self, insee):
        bbox = self.db.get_city_bbox(insee)
        LOG.info(f"Tiles for city {insee} must be regenerated in bbox {str(bbox)}")
        with open("tiles/outdated.txt", "a") as fd:
            fd.write(str(bbox) + "\n")

    def fetch_osm_data(self, city, force):
        """
        Compute the latest import date for given city
        """
        if force or city.import_date in City.bad_dates():
            sources_date = []
            simplified_buildings = []
            if not city.is_raster:
                try:
                    # iterate on every building
                    buildings = []
                    for element in self.overpass.get_city_buildings(city, self.IGNORED_BUILDINGS):
                        tags = element.get("tags")
                        if element.get("type") == "node":
                            # some buildings are mainly nodes, but we don't care much about them
                            ignored_node_buildings = ["hut", "shed", "no", "ruins", "bunker", "wayside_shrine"]
                            if (
                                tags.get("power")
                                or tags.get("ruins")
                                or tags.get("historic")
                                or tags.get("building") in ignored_node_buildings
                            ):
                                continue

                            LOG.info(
                                f"{city} contient des bâtiments "
                                f"avec une géométrie simplifée {element}, import probablement jamais réalisé"
                            )
                            simplified_buildings.append(element.get("id"))

                        buildings.append(element.get("timestamp")[:4])
                    has_simplified = len(simplified_buildings) > 0
                    (import_date, sources_date) = self.date_for_buildings(city.insee, buildings, has_simplified)
                    # only update date if we did not use cache files for buildings
                    city.import_date = import_date
                    city.import_details = {"simplified": simplified_buildings, "dates": sources_date}
                    self.db.session.commit()
                except Exception as e:
                    LOG.error(f"Failed to count buildings for {city}: {e}")
        return city

    def date_for_buildings(self, insee, dates, has_simplified_buildings):
        """
        Computes the city import date, given a list of buildings date
        """
        sources_date = []
        for b in dates:
            source = (b or "unknown").lower()
            date = re.sub(self.cadastre_src2date_regex, r"\2", source)
            sources_date.append(date)
        counter = Counter(sources_date)
        LOG.debug(f"City {insee} stats: {counter}")

        date = max(counter, key=sources_date.count) if len(sources_date) else "never"
        if date != "never" and date != "raster":
            date_match = re.compile(r"^(\d{4})$").match(date)
            date = date_match.groups()[0] if date_match and date_match.groups() else "unknown"
            # If a city has a few buildings, and **even if a date could be computed**, we assume
            # it was never imported (sometime only 1 building on the boundary is wrongly computed)
            # Almost all cities have at least church/school/townhall manually mapped
            if len(dates) < 10 and insee not in self.NO_BUILDING_CITIES:
                LOG.info(f"City {insee}: too few buildings found ({len(dates)}), assuming it was never imported!")
                date = "never"
            elif has_simplified_buildings:
                date = "unfinished"
        return (date, counter)

    def import_city_stats_from_osmplanet(self, departments):
        LOG.info(f"Calcul des statistiques du bâti pour les départements {departments}…")
        for idx, dept in enumerate(departments):
            # 1. fetch global stats for current department of all buildings
            LOG.info(f"Calcul des statistiques du bâti pour le département {dept}…")
            result = self.db.get_building_dates_per_city_for_department(dept, self.IGNORED_BUILDINGS)

            buildings = {}
            insee_name = {}
            for (insee, name, source, count, is_raster) in result:
                if is_raster:
                    insee_name[insee] = name
                    buildings[insee] = ["raster"]
                else:
                    if not buildings.get(insee):
                        buildings[insee] = []
                    insee_name[insee] = name
                    buildings[insee] += [source] * count

            # 2. fetch all simplified buildings in current department
            LOG.info(f"Récupération du bâti simplifié pour le département {dept}…")
            city_with_simplified_building = self.db.get_point_buildings_per_city_for_department(dept)

            simplified_cities = list(set([x[0] for x in city_with_simplified_building]))
            if len(simplified_cities) > 0:
                LOG.info(f"Les villes {simplified_cities} contiennent des bâtiments " "avec une géométrie simplifée, import à vérifier")

            # 3. finally compute city import date and update database
            LOG.info(f"Mise à jour des statistiques pour le département {dept}…")
            for insee, buildings in buildings.items():
                # compute city import date based on all its buildings date
                (import_date, counts) = self.date_for_buildings(insee, buildings, insee in simplified_cities)
                simplified = [x[1] for x in city_with_simplified_building if x[0] == insee]

                city = self.db.get_city_for_insee(insee)
                city.name = insee_name[insee]
                # do not erase date if what we found here is a bad date (unknown)
                if city.import_date in City.bad_dates() or import_date not in City.bad_dates():
                    city.import_date = import_date
                city.last_update = datetime.datetime.now()
                city.import_details = {"dates": counts, "simplified": simplified}

            self.db.session.commit()
            yield idx + 1
