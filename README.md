# SnipeIT

Outil de backtest de stratégies crypto.  
Stack : Node.js + Express + Prisma (MySQL) + vanilla JS + worker Python.

---

## Installation rapide

```bash
# 1. Dépendances Node
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, JWT_SECRET, NODE_ENV

# 3. Appliquer le schéma Prisma
npx prisma migrate dev --name init

# 4. Lancer le serveur
npm run dev
```

Accès : http://localhost:4000

---

## Worker Python

```bash
cd python
pip install -r requirements.txt
cp .env.example .env
# Éditer .env : SNIPEIT_API_KEY (généré depuis l'UI > API Keys), SNIPEIT_BASE_URL

python snipeit_worker.py
```

---

## Architecture

```
Flux normal :
  UI → POST /api/jobs               → crée un job "pending"
  Worker → GET /api/worker/jobs     → claim les jobs pending (→ "running")
  Worker → POST /api/worker/jobs/:id/result → soumet résultats (→ "done" | "error")
  UI → GET /api/jobs/:id            → affiche les résultats

Auth :
  Utilisateurs  : JWT dans cookie httpOnly (30j)
  Worker        : Bearer token (clé API hashée en DB)
```

---

## Routes API

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/auth/register | Créer un compte |
| POST | /api/auth/login | Connexion |
| GET  | /api/auth/me | Utilisateur courant |
| POST | /api/auth/logout | Déconnexion |

### Stratégies (authentifié)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET    | /api/strategies | Lister les stratégies |
| POST   | /api/strategies | Créer une stratégie |
| GET    | /api/strategies/:id | Détail |
| PUT    | /api/strategies/:id | Modifier |
| POST   | /api/strategies/:id/clone | Cloner |
| DELETE | /api/strategies/:id | Supprimer |

### Jobs (authentifié)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/jobs | Lancer un backtest |
| GET  | /api/jobs | Lister les jobs |
| GET  | /api/jobs/:id | Détail + résultats |
| POST | /api/jobs/:id/cancel | Annuler (si pending) |

### API Keys (authentifié)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET    | /api/apikeys | Lister les clés |
| POST   | /api/apikeys | Créer une clé |
| DELETE | /api/apikeys/:id | Supprimer |

### Worker (clé API Bearer)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | /api/worker/jobs | Poll les jobs pending |
| POST | /api/worker/jobs/:id/result | Soumettre les résultats |

---

## Format `conditions`

```json
{
  "entry": [
    { "indicator": "RSI", "period": 14, "operator": "<", "value": 30 },
    { "indicator": "PRICE", "operator": ">", "value": 20000 }
  ],
  "exit": [
    { "indicator": "RSI", "period": 14, "operator": ">", "value": 70 }
  ]
}
```

Indicateurs : `RSI`, `EMA`, `SMA`, `MACD`, `BB_UPPER`, `BB_LOWER`, `BB_MID`, `PRICE`, `VOLUME`  
Opérateurs : `>`, `<`, `>=`, `<=`, `==`, `cross_above`, `cross_below`

---

## Format résultats (retourné par le worker)

```json
{
  "pnlPercent":    12.34,
  "pnlAbsolute":   123.40,
  "finalCapital":  1123.40,
  "initialCapital": 1000,
  "totalTrades":   18,
  "winRate":       61.1,
  "maxDrawdown":   8.2,
  "sharpeRatio":   1.45,
  "durationDays":  365,
  "equityCurve":   [{ "date": "2024-01-01", "equity": 1000 }, ...],
  "trades":        [{ "side": "buy", "date": "...", "price": 42000, ... }, ...]
}
```
