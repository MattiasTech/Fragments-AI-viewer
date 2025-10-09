export const computeModelKey = async (input: { modelUrl: string; extra?: string }): Promise<string> => {
  const encoder = new TextEncoder();
  const payload = `${input.modelUrl}|${input.extra ?? ''}`;
  const data = encoder.encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  const base64Url = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
  return base64Url;
};
