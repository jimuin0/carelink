import createOptimizer from '@vinext/cloudflare/images/images-optimizer.runtime';

// A quota or transformation error must trigger vinext's original-image
// fallback instead of being returned as a successful image response.
export default function createSafeOptimizer(input: Parameters<typeof createOptimizer>[0]) {
  const optimizer = createOptimizer(input);
  return { async transformImage(...args: Parameters<typeof optimizer.transformImage>) {
    const response = await optimizer.transformImage(...args);
    if (!response.ok || !/^image\/(?:avif|webp|jpeg|png|gif)$/i.test(response.headers.get('content-type')?.split(';')[0].trim() || '')) {
      throw new Error('Image transformation unavailable');
    }
    return response;
  } };
}
