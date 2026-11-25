import { Transform } from 'class-transformer';
import { type ValidationArguments, registerDecorator } from 'class-validator';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Custom predicate validator with a fixed message. */
export function Satisfies(check: (value: string) => boolean, message: string) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: { message },
      validator: {
        validate: (value: unknown, _args: ValidationArguments) =>
          typeof value === 'string' && check(value),
      },
    });
}

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Monetary amount in BRL, sent as a decimal string ("15000.50") so no
 * precision is lost in JSON. Numbers are accepted and converted. Max 12 integer
 * digits and 2 decimals (NUMERIC(14,2)).
 */
export function IsMoney(opts: { positive?: boolean } = {}) {
  const transform = Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toString() : value,
  );
  const validate = Satisfies(
    (v) => MONEY.test(v) && (!opts.positive || Number(v) > 0),
    opts.positive
      ? 'Informe um valor maior que zero, com até 2 casas decimais'
      : 'Informe um valor maior ou igual a zero, com até 2 casas decimais',
  );
  return (target: object, propertyName: string) => {
    transform(target, propertyName);
    validate(target, propertyName);
  };
}
