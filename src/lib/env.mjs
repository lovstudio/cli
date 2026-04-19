export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

export function optionalEnv(name) {
  return process.env[name] || null;
}
