const { utc } = require('moment');
const { generateRandomInt } = require('../dist/utils');

const clock = (() => {
  let now = null;
  const setNow = dt => now = dt;
  const utcNow = () => (now ? now.clone() : utc());
  const pause = () => setNow(utc());
  const forward = (...args) => {
    if (now) {
      setNow(now.add(...args));
    }
  };
  const reset = () => now = null;

  return {
    setNow, utcNow, pause, forward, reset,
  };
})();

const generatePhoneNumber = () => `+${generateRandomInt(10000000000, 99999999999)}`;

module.exports = {
  clock,
  generatePhoneNumber,
  generateRandomInt,
};
