import {async, ComponentFixture, TestBed} from '@angular/core/testing';

import {CityDetailsDialogComponent} from './city-details-dialog.component';
import {MatLibModule} from '../mat-lib.module';
import {SharedComponentsModule} from '../../components/shared-components.module';
import {MAT_DIALOG_DATA} from '@angular/material';
import {HttpModule} from '@angular/http';
import {HttpClientTestingModule} from '../../../../node_modules/@angular/common/http/testing';
import {CityDTO} from '../../classes/city.dto';
import {AppConfigService} from 'src/app/services/app-config.service';

class MockAppConfigService {
  getConfig() {
    return {
      'backendServerUrl': 'http://localhost:5000/',
      'tilesServerUrl': 'http://localhost:9999/maps/batimap/{z}/{x}/{y}.vector.pbf'
    };
  }
}

describe('CityDetailsDialogComponent', () => {
  let component: CityDetailsDialogComponent;
  let fixture: ComponentFixture<CityDetailsDialogComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [CityDetailsDialogComponent],
      imports: [MatLibModule, SharedComponentsModule, HttpModule, HttpClientTestingModule],
      providers: [
        {provide: MAT_DIALOG_DATA, useValue: {}},
        {provide: AppConfigService, useValue: MockAppConfigService},
      ]
    })
      .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CityDetailsDialogComponent);
    component = fixture.componentInstance;
    component.city = new CityDTO();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
