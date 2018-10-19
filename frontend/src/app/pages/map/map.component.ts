import {Component, NgZone, ViewChild} from '@angular/core';
import { AppConfigService } from '../../services/app-config.service';

import * as L from 'leaflet';
import {latLng, tileLayer} from 'leaflet';
import {MatDialog} from '@angular/material';
import {CityDetailsDialogComponent} from '../city-details-dialog/city-details-dialog.component';
import {CityDTO} from '../../classes/city.dto';
import {plainToClass} from 'class-transformer';
import {MapDateLegendComponent} from '../../components/map-date-legend/map-date-legend.component';
import {LegendService} from '../../services/legend.service';
import {CityDetailsDTO} from '../../classes/city-details.dto';

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css']
})
export class MapComponent {
  @ViewChild(MapDateLegendComponent) legend: MapDateLegendComponent;

  options = {
    layers: [
      tileLayer('https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png',
        {
          maxZoom: 18,
          attribution: '© Contributeurs OpenStreetMap'
        })
    ],
    zoom: 5,
    maxZoom: 13,
    center: latLng(46.111, 3.977)
  };
  map: L.Map;
  cadastreLayer: any;

  constructor(private matDialog: MatDialog,
              private zone: NgZone,
              private legendService: LegendService,
              private configService: AppConfigService) {
  }

  onMapReady(map) {
    this.map = map;
    map.restoreView();
    this.setupVectorTiles(map);
  }

  stylingFunction(properties, zoom, type): any {
    const date = this.legendService.city2date.get(properties.insee) || properties.date;
    const color = this.legendService.date2color(date);
    if (!this.legendService.isActive(date)) {
      return [];
    }
    return {
      weight: 2,
      color: color,
      opacity: 1,
      fill: true,
      radius: type === 'point' ? zoom / 2 : 1,
      fillOpacity: 0.7
    };
  }

  setupVectorTiles(map) {
    const vectorTileOptions = {
      // rendererFactory: canvas.tile,
      maxZoom: 20,
      maxNativeZoom: 13,
      vectorTileLayerStyles: {
        'cities-point': (properties, zoom) => this.stylingFunction(properties, zoom, 'point'),
        'cities': (properties, zoom) => this.stylingFunction(properties, zoom, 'polygon'),
        'departments': (properties, zoom) => this.stylingFunction(properties, zoom, 'polygon'),
      },
      interactive: true,  // Make sure that this VectorGrid fires mouse/pointer events
      getFeatureId: function (f) {
        return f.properties.date;
      }
    };

    this.cadastreLayer = L.vectorGrid.protobuf(this.configService.getConfig().tilesServerUrl, vectorTileOptions);
    this.cadastreLayer.on('click', (e) => {
      this.zone.run(() => {
        this.openPopup(e.layer.properties);
      });
    });
    this.cadastreLayer.addTo(map);

    this.legend.cadastreLayer = this.cadastreLayer;
  }

  openPopup(cityJson: any) {
    const city = plainToClass<CityDTO, object>(CityDTO, cityJson);
    if (cityJson.details) {
      city.details = plainToClass<CityDetailsDTO, object>(CityDetailsDTO, JSON.parse(cityJson.details));
    }
    this.matDialog.open(CityDetailsDialogComponent, {data: [city, this.cadastreLayer]});
  }
}
