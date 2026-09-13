# AllAi 远程控制中继。先在开发机上 `npm run remote:build` 生成 relay/dist，
# 再把 relay/ 整个目录传到服务器，在里面 `docker compose up -d --build`。
FROM node:22-alpine
WORKDIR /app
COPY dist/ ./
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server.cjs"]
