/**
 * Race a promise against a timeout. Used to bound network calls to Firestore so
 * that a dropped wifi connection fails over to the local store in seconds
 * instead of hanging on the underlying gRPC deadline (~60s).
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default withTimeout;
