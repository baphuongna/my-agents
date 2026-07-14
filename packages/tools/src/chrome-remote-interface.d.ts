declare module "chrome-remote-interface" {
  interface Options {
    port?: number;
    host?: string;
  }

  interface Client {
    Page: any;
    Runtime: any;
    Input: any;
    DOM: any;
    close(): Promise<void>;
  }

  function CDP(options?: Options): Promise<Client>;
  export default CDP;
}
