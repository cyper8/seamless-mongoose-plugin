#!/bin/bash

if [[ -n `which docker` ]]; then
  if [[ -z `docker ps -q -f name=seamless` ]]; then
    docker start seamless || docker run --name seamless -d -p 27017:27017 mongo;
  fi
  unset TEST_DB_URL;
elif [[ -f "./test/.env" ]]; then
  export TEST_DB_URL=`cat ./test/.env`
else
  echo "Please provide mongodb connection string in ./test/.env file or install docker"
  exit 1
fi
exit 0;
