import { Injectable } from '@angular/core';
import { AppConfigService } from './app-config.service';

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { plainToClass } from 'class-transformer';
import { ClassType } from 'class-transformer/ClassTransformer';
import { LatLngBounds } from 'leaflet';
import { Observable, of, pipe, timer } from 'rxjs';
import { debounceTime, map, switchMap, takeWhile, tap } from 'rxjs/operators';
import { CityDTO, StatsDetailsDTO } from '../classes/city.dto';
import { ConflateCityDTO } from '../classes/conflate-city.dto';
import { DepartmentDTO } from '../classes/department.dto';
import { LegendDTO } from '../classes/legend.dto';
import { ObsoleteCityDTO } from '../classes/obsolete-city.dto';
import { HttpErrorInterceptor } from './http-error.interceptor';
import { LegendService } from './legend.service';

export enum TaskState {
    PENDING = 'PENDING',
    PROGRESS = 'PROGRESS',
    FAILURE = 'FAILURE',
    SUCCESS = 'SUCCESS',
}

export interface TaskResult<T> {
    state: TaskState;
    result: T;
    progress: TaskProgress;
}

export interface Task {
    task_id: string;
}

export class TaskProgress {
    constructor(public current: number, public _total: number) {}
}

@Injectable({
    providedIn: 'root',
})
export class BatimapService {
    constructor(
        private readonly http: HttpClient,
        private readonly legendService: LegendService,
        private readonly configService: AppConfigService
    ) {}

    cityData(insee: string): Observable<TaskResult<ConflateCityDTO>> {
        return this.longRunningAPI<ConflateCityDTO>(this.URL_CITY_DATA(insee), ConflateCityDTO);
    }

    legendForBbox(bbox: LatLngBounds): Observable<LegendDTO[]> {
        return this.http
            .get<LegendDTO[]>(
                this.URL_LEGEND(
                    bbox.getNorthWest().wrap().lng,
                    bbox.getNorthWest().wrap().lat,
                    bbox.getSouthEast().wrap().lng,
                    bbox.getSouthEast().wrap().lat
                ),
                HttpErrorInterceptor.ByPassInterceptor()
            )
            .pipe(
                map(r => plainToClass(LegendDTO, r)),
                switchMap((legends: LegendDTO[]) => {
                    for (const l of legends) {
                        l.checked = this.legendService.isActive(l);
                    }

                    return of(legends);
                }),
                debounceTime(3000)
            );
    }

    updateCity(insee: string): Observable<TaskResult<CityDTO>> {
        return this.longRunningAPI<CityDTO>(this.URL_CITY_UPDATE(insee), CityDTO).pipe(
            tap(progress => {
                if (progress.state === TaskState.SUCCESS) {
                    this.legendService.city2date.set(progress.result.insee, progress.result.date);
                }
            })
        );
    }

    obsoleteCity(ignored: string[]): Observable<ObsoleteCityDTO> {
        return this.http.get<ObsoleteCityDTO>(this.URL_CITY_OBSOLETE(), {
            params: {
                ignored: ignored.join(','),
            },
        });
    }

    departmentDetails(insee: string): Observable<StatsDetailsDTO> {
        return this.http.get<StatsDetailsDTO>(this.URL_DEPARMENT_DETAILS(insee));
    }

    department(insee: string): Observable<DepartmentDTO> {
        return this.http.get<DepartmentDTO>(this.URL_DEPARTMENT(insee));
    }

    city(insee: string): Observable<CityDTO> {
        return this.http.get<CityDTO>(this.URL_CITY(insee));
    }

    osmid(insee: string): Observable<number> {
        return this.http.get<number>(this.URL_OSMID(insee));
    }

    private URL_TASK(task: Task): string {
        return `${this.configService.getConfig().backServerUrl}/tasks/${task.task_id}`;
    }

    private URL_CITY_DATA(insee: string): string {
        return `${this.configService.getConfig().backServerUrl}cities/${insee}/josm`;
    }

    private URL_CITY_UPDATE(insee: string): string {
        return `${this.configService.getConfig().backServerUrl}cities/${insee}/update`;
    }

    private URL_LEGEND(lonNW: number, latNW: number, lonSE: number, latSE: number) {
        return `${this.configService.getConfig().backServerUrl}legend/${lonNW}/${latNW}/${lonSE}/${latSE}`;
    }

    private URL_CITY_OBSOLETE() {
        return `${this.configService.getConfig().backServerUrl}cities/obsolete`;
    }

    private URL_DEPARTMENT(insee: string) {
        return `${this.configService.getConfig().backServerUrl}departments/${insee}`;
    }

    private URL_DEPARMENT_DETAILS(insee: string) {
        return `${this.configService.getConfig().backServerUrl}departments/${insee}/details`;
    }

    private URL_CITY(insee: string) {
        return `${this.configService.getConfig().backServerUrl}cities/${insee}`;
    }

    private URL_OSMID(insee: string) {
        return `${this.configService.getConfig().backServerUrl}insees/${insee}/osm_id`;
    }

    private longRunningAPI<T>(url, cls: ClassType<T>): Observable<TaskResult<T>> {
        return this.http.get<Task>(url).pipe(
            switchMap(task =>
                timer(0, 3000).pipe(
                    switchMap(() => this.http.get<TaskResult<T>>(this.URL_TASK(task))),
                    takeWhile(r => r.state === TaskState.PENDING || r.state === TaskState.PROGRESS, true),
                    tap(r => {
                        if (r.state === TaskState.PENDING) {
                            r.progress = new TaskProgress(0, 100);
                        } else if (r.state === TaskState.PROGRESS) {
                            r.progress = plainToClass(TaskProgress, r.result);
                            r.result = undefined;
                        } else if (r.state === TaskState.FAILURE) {
                            throw new Error(r.result.toString());
                        } else {
                            r.result = plainToClass(cls, r.result);
                            r.progress = new TaskProgress(100, 100);
                        }
                    })
                )
            )
        );
    }
}
