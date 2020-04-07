import { Pipe, PipeTransform } from '@angular/core';
import { LegendService } from '../services/legend.service';

@Pipe({
    name: 'legend',
    pure: true
})
export class LegendPipe implements PipeTransform {
    constructor(private readonly legendService: LegendService) {}
    transform(value: string | string[], type?: string): string | string[] {
        const legendFunc = v =>
            type === 'color'
                ? this.legendService.date2color(v)
                : this.legendService.date2name(v) === 'indéterminé'
                ? v
                : this.legendService.date2name(v);

        return value instanceof Array ? value.map(legendFunc) : legendFunc(value);
    }
}
