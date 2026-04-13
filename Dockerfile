FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY index.html styles.css game.js rules.js server.js ./
COPY ZO5gK_fBtCAy6w_ZIPiLwlTdOqaqoPY1utyDWl7G5j24y-HQ1101ECu2w63_cQ_TZTyerpa0Ohr_SA6wqtk76lF6.jpg ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
