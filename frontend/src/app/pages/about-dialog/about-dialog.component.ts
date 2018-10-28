import {Component, OnDestroy} from '@angular/core';

@Component({
  selector: 'app-about-dialog',
  templateUrl: './about-dialog.component.html',
  styleUrls: ['./about-dialog.component.css']
})
export class AboutDialogComponent implements OnDestroy {
  ngOnDestroy() {
    localStorage.setItem('first-time-help', 'false');
  }
}
