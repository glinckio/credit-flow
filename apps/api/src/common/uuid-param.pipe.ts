import { Injectable, type PipeTransform } from '@nestjs/common';
import { Problems } from './http/app-exception.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates `:id` route params. A malformed id answers 404 (same as an unknown
 * or inaccessible one), so ids cannot be probed.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  constructor(private readonly what = 'Recurso') {}

  transform(value: string): string {
    if (!UUID.test(value)) throw Problems.notFound(this.what);
    return value.toLowerCase();
  }
}
