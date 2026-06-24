# ⛏ MineLandia Multiplayer 2D Mining Game (AI)

Przeglądarkowa gra kooperacyjna w kopanie. Widok 2D z góry, świat generowany proceduralnie, multiplayer w czasie rzeczywistym przez WebSocket.

## Stack

- **Frontend:** HTML + Canvas API + CSS
- **Backend:** Node.js + Express + Socket.io
- **Baza danych (produkcja):** PostgreSQL + Redis
- **Serwer deweloperski:** In-memory (wszystko działa bez bazy danych)

## Uruchomienie (dev)

```bash
npm install
node server/index.js
# Otwórz http://localhost:3000
```

## Struktura projektu

```
minelandia/
├── server/
│   ├── index.js        # Express + Socket.io — główna logika serwera
│   └── worldgen.js     # Generowanie świata (deterministic, seed-based)
├── client/
│   ├── index.html      # HTML + UI
│   ├── style.css       # Stylowanie
│   └── game.js         # Canvas renderer + logika klienta + Socket.io
├── db/
│   └── schema.sql      # Schemat PostgreSQL (produkcja)
└── .env.example        # Konfiguracja środowiska
```

## Mechaniki gry

### Świat
- Nieskończony, generowany proceduralnie z deterministycznego seeda `(x, y, depth)`
- Każda kratka ma głębokość — kopanie zwiększa ją o 1
- Bloki dostępne tylko na starcie (3×3 środek) lub sąsiadujące z już odkrytymi

### Bloki
- 7 typów (dirt, grass, stone, deepstone, granite, obsidian, bedrock)
- 10 rud (coal, iron, copper, silver, gold, ruby, sapphire, emerald, diamond, mythril)
- HP i szansa na rudę rosną z głębokością

### Multiplayer
- Wszyscy kopią ten sam świat w czasie rzeczywistym
- Widać animacje kopania innych graczy
- Podział łupów proporcjonalny do zadanego damage

### Kilofy
- 11 typów kilofy do craftowania z rud
- Craftowanie w menu (surowce pobierane z ekwipunku)

## Sterowanie

| Akcja | Klawisz/Przycisk |
|---|---|
| Poruszanie kamerą | WASD / strzałki |
| Przeciąganie mapy | Prawy przycisk myszy |
| Wybranie bloku | Lewy klik |
| Kopanie | Przycisk "Kop!" lub Spacja |

## Podłączenie PostgreSQL (produkcja)

1. Utwórz bazę danych: `createdb deepdig`
2. Wykonaj schemat: `psql deepdig < db/schema.sql`
3. Skonfiguruj `.env` z `DATABASE_URL`
4. Zastąp `Map()` w `server/index.js` zapytaniami `pg`

## Podłączenie Redis (produkcja)

Redis służy do przechowywania aktualnego HP bloków (szybki odczyt/zapis). Klucze: `block:hp:{x},{y}`.
