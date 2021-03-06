import { NgModule } from '@angular/core';
import { LeafletModule } from '@asymmetrik/ngx-leaflet';
import { MapComponent } from './map.component';

import { CommonModule } from '@angular/common';
import '@bagage/leaflet.restoreview';
import '@bagage/leaflet.vectorgrid';
import 'leaflet';
import 'leaflet-geocoder-ban/dist/leaflet-geocoder-ban';
import 'leaflet-hash';
import { SharedComponentsModule } from '../../components/shared-components.module';
import { MatLibModule } from '../../mat-lib.module';
import { PipesModule } from '../../pipes/pipes.module';
import { TasksModule } from '../tasks/tasks.module';

@NgModule({
    imports: [CommonModule, LeafletModule, MatLibModule, SharedComponentsModule, TasksModule, PipesModule],
    declarations: [MapComponent],
})
export class MapModule {}
