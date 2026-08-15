// tsup inlines these as base64 data URLs — see the `loader` in tsup.config.ts.
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
