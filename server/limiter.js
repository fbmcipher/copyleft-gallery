// Minimal promise-pool limiter. Met asks nicely not to be hammered — cap
// object fetches at ~15 concurrent (§3).
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length) {
      active++;
      const run = queue.shift();
      run();
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() =>
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          })
      );
      pump();
    });
}
