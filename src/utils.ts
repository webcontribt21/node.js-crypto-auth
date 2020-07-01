import { randomBytes } from 'crypto';

export const generateRandomInt = (min, max) => {
  // eslint-disable-next-line no-param-reassign
  min = Math.ceil(min);
  // eslint-disable-next-line no-param-reassign
  max = Math.floor(max);
  // eslint-disable-next-line no-mixed-operators
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const generateEmailSecret = (size: number) => {
  const buffer = randomBytes(size);
  return buffer
    .toString('base64')
    .replace(/\+/g, '_')
    .replace(/\//g, '-')
    .replace(/=*$/g, '');
};
