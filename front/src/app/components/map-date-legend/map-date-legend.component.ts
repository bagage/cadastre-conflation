import { Component, EventEmitter, HostListener, Input, NgZone, OnInit, Output, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSlider } from '@angular/material/slider';
import * as L from 'leaflet';
import { BehaviorSubject, combineLatest, Observable, of, zip } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, skip, startWith, switchMap, tap } from 'rxjs/operators';
import { LegendDTO } from '../../classes/legend.dto';
import { ObsoleteCityDTO } from '../../classes/obsolete-city.dto';
import { BatimapService } from '../../services/batimap.service';
import { LegendService } from '../../services/legend.service';
import { AboutDialogComponent } from '../about-dialog/about-dialog.component';
import { CityDetailsDialogComponent } from '../city-details-dialog/city-details-dialog.component';
import { Unsubscriber } from '../unsubscriber';
import { MapDateLegendModel } from './map-date-legend.model';

@Component({
    selector: 'app-map-date-legend',
    templateUrl: './map-date-legend.component.html',
    styleUrls: ['./map-date-legend.component.css'],
})
export class MapDateLegendComponent extends Unsubscriber implements OnInit {
    @Input() map: L.Map;
    @Input() cadastreLayer;
    @Input() hideCheckboxes: boolean;

    @Output() readonly hideLegend = new EventEmitter();

    legendItems$: Observable<MapDateLegendModel[]>;
    bounds: L.LatLngBounds;
    error = false;
    legendChanged$ = new BehaviorSubject<LegendDTO>(undefined);

    @ViewChild(MatSlider)
    set countSlider(countSlider: MatSlider) {
        if (countSlider) {
            setTimeout(() => {
                countSlider.value = +(localStorage.getItem('min-buildings-ratio') || '0');
                this.redrawMapOnChange(countSlider);
            });
        }
    }

    constructor(
        private readonly zone: NgZone,
        private readonly batimapService: BatimapService,
        public legendService: LegendService,
        private readonly matDialog: MatDialog
    ) {
        super();
    }

    ngOnInit() {
        this.refreshLegend();
        this.map.on('moveend', () => {
            this.zone.run(() => {
                this.refreshLegend();
            });
        });
    }

    redrawMapOnChange(countSlider: MatSlider) {
        /* redraw map on slider value update */
        this.autoUnsubscribe(
            combineLatest([
                countSlider.change.pipe(
                    startWith({ value: countSlider.value }),
                    tap((event: any) => {
                        localStorage.setItem('min-buildings-ratio', event.value.toFixed(0));
                    })
                ),
                this.legendChanged$,
            ])
                .pipe(skip(1), debounceTime(200), distinctUntilChanged())
                .subscribe(() => {
                    this.zone.runOutsideAngular(() => {
                        this.cadastreLayer.redraw();
                    });
                })
        );
    }

    refreshLegend() {
        const bounds = this.map.getBounds();
        if (this.bounds && this.bounds.toBBoxString() === bounds.toBBoxString()) {
            return;
        }

        this.bounds = bounds;
        this.error = false;
        this.legendItems$ = this.batimapService.legendForBbox(this.bounds).pipe(
            catchError(err => {
                this.error = true;
                throw err;
            }),
            map(items =>
                items.map(
                    it =>
                        new MapDateLegendModel(
                            it.name,
                            it.checked,
                            it.count,
                            it.percent,
                            this.legendService.date2name(it.name),
                            this.legendService.date2color(it.name)
                        )
                )
            )
        );
        if (this.batimapService.ignoredInsees().length > 0) {
            this.legendItems$ = zip(
                of([
                    new MapDateLegendModel(
                        'ignored',
                        this.legendService.isActive('ignored'),
                        this.batimapService.ignoredInsees().length,
                        undefined,
                        this.legendService.date2name('ignored'),
                        this.legendService.date2color('ignored')
                    ),
                ]),
                this.legendItems$
            ).pipe(map(result => result[0].concat(result[1])));
        }
    }

    legendChanges(legend: LegendDTO) {
        this.legendService.toggleActive(legend, legend.checked);
        this.legendChanged$.next(legend);
    }

    @HostListener('document:keydown.shift.a') openHelp() {
        this.matDialog.open(AboutDialogComponent);
    }

    @HostListener('document:keydown.shift.h') emitHideLegend(): void {
        this.hideLegend.emit();
    }

    @HostListener('document:keydown.shift.c') feelingLucky() {
        this.autoUnsubscribe(
            this.legendItems$
                .pipe(
                    map(items => items.filter(it => !this.legendService.isActive(it)).map(it => it.name)),
                    switchMap(ignored => this.batimapService.obsoleteCity(ignored))
                )
                .subscribe((obsoleteCity: ObsoleteCityDTO) => {
                    this.map.setView(obsoleteCity.position, 10, {
                        animate: false,
                    });
                    setTimeout(() => {
                        this.matDialog.closeAll();
                        const dialog = this.matDialog.open<CityDetailsDialogComponent>(CityDetailsDialogComponent, {
                            data: [obsoleteCity.city, obsoleteCity.osmid, this.cadastreLayer],
                        });
                        dialog.afterOpened().subscribe(() => dialog.componentInstance.updateCity());
                    }, 0);
                })
        );
    }

    formatPercentage(value: number) {
        if (value > 99) {
            return '>99%';
        } else {
            return `${value}%`;
        }
    }
}
