install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm test

lint:
	npm run lint

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

migrate:
	npm run migrate --workspace apps/api

seed:
	npm run seed --workspace apps/api

extension-build:
	npm run build --workspace apps/extension

extension-zip: extension-build
	cd apps/extension/dist && zip -r ../extension.zip .
