import { Pipe, PipeTransform } from '@angular/core';

/**
 * Count with a correctly pluralised noun: `{{ 1 | plural: 'report' }}` → "1 report",
 * `{{ 3 | plural: 'report' }}` → "3 reports". Pass the plural form for irregular nouns:
 * `{{ n | plural: 'person' : 'people' }}`.
 */
@Pipe({ name: 'plural' })
export class PluralPipe implements PipeTransform {
  transform(count: number | null | undefined, singular: string, plural = `${singular}s`): string {
    const value = count ?? 0;
    return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
  }
}
