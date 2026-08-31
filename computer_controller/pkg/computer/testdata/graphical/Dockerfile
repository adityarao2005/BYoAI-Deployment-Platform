FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xdotool xclip maim \
    && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:99
CMD ["Xvfb", ":99", "-screen", "0", "1024x768x24", "-ac"]
