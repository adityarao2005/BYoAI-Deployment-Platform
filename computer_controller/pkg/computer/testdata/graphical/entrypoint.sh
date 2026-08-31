#!/bin/sh
Xvfb :99 -screen 0 1024x768x24 -ac &
sleep 1
twm &
exec "$@"
