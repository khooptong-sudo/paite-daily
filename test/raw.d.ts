// Vite turns a "?raw" import into the file's text. Tests use it to read the static pages.
declare module "*?raw" {
  const text: string;
  export default text;
}
