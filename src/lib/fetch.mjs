// Thin wrapper around fetch that honors HTTPS_PROXY / https_proxy.
// Uses Node's built-in undici. Falls back to bare fetch when no proxy is set.

import { ProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy));
  }
}

export async function hfetch(url, init) {
  configure();
  return fetch(url, init);
}
