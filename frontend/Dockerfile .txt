# Utilisez une version de Node.js compatible avec node-sass (v14)
FROM node:14.21.3-bullseye

# # Installation des dépendances système requises
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# RUN sed -i 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' /etc/apt/sources.list && \
#     sed -i '/security.debian.org/d' /etc/apt/sources.list && \
#     apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*


# Configuration Python
RUN ln -sf /usr/bin/python2 /usr/bin/python

WORKDIR /app

COPY package*.json ./

# Installation spécifique pour les anciennes dépendances
RUN npm install -g @angular/cli@15.2.10
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 4200
CMD ["npm", "start"]