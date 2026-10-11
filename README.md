# Ma'ak — health coordination for displaced people in Lebanon

Ma'ak connects displaced families, shelters, volunteers, doctors, donors, NGOs and the Ministry of
Public Health around one thing: keeping people's health care going when they have to move.

This is the foundation: the Firestore database layer, data models, sign-up and sign-in with a phone
code, and the frontend shell (layout, Arabic/English, logo). Each role is added on its own branch as
one file in `backend/app/roles/` and one in `frontend/src/roles/`.

## Run it

You need **Python 3.10+** and **Node.js 18+**.

```bash
cd backend
pip install -r requirements.txt
python run.py            # http://127.0.0.1:5000/api/health
```

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Copy `backend/.env.example` to `backend/.env` and fill it in. Never commit `.env` or the Firebase key.
Verification codes are printed in the terminal running `python run.py`.
