# trading-zoo-auth

## Requirements

- RabbitMQ
- Node.js

## Installation

Add `config/local.json` file with the content, use your own key, or ask development key from the team

```json
{
  "twilio": {
    "accountSid": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "authToken": "2eXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "from": "+12312313123",
    "body": "Your verification code is"
  }
}
```

```sh
npm install
npm run build
```

## Tests

```sh
npm run build
npm test
```

## Coverage Report

```sh
npm run build
nyc tap test
open ./reports/coverage/index.html
```

## Starting Services

```sh
npm run build
npm start
```
