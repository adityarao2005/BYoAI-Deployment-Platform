FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xdotool xclip maim twm \
    && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:99
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]
