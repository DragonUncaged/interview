// Lets plain `node --experimental-strip-types` load src/lib modules, which use
// extensionless relative imports (`./langs`) the way the Next bundler expects.
import { register } from 'node:module';

const hook = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`;

register(`data:text/javascript,${encodeURIComponent(hook)}`);
