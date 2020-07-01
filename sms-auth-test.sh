#!/bin/sh
PHONE_NUMBER=+79166389382
URL=https://login.dev.bct.trade
# URL=http://localhost:8008

# issue device token
DEVICE_TOKEN=$(curl -v -XPOST $URL/api/tokens/device | jq -r .ok.deviceToken) && echo $DEVICE_TOKEN

# trying to issue session token
curl -v -XPOST -H "Authorization: Bearer $DEVICE_TOKEN"  $URL/api/tokens/session

# send authentication request
curl -v -XPOST -d "{ \"phoneNumber\": \"$PHONE_NUMBER\" }" -H "Content-Type: application/json" -H "Authorization: Bearer $DEVICE_TOKEN" $URL/api/sms/send-code

SECRET_CODE=
# confirm the code
curl -v -XPOST -d "{ \"secretCode\": \"$SECRET_CODE\" }" -H "Content-Type: application/json" -H "Authorization: Bearer $DEVICE_TOKEN" $URL/api/sms/verify

# reissue the token when expired
curl -v -XPOST -H "Authorization: Bearer $DEVICE_TOKEN" $URL/api/tokens/session
