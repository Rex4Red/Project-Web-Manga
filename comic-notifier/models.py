from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin

# Inisialisasi Database
db = SQLAlchemy()

# Tabel User
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False) # Nanti akan di-hash (dienkripsi)
    webhook_url = db.Column(db.String(500), nullable=True)
    
    # Relasi: Satu user bisa punya banyak favorit
    favorites = db.relationship('Favorite', backref='user', lazy=True)

# Tabel Komik Favorit
class Favorite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    url = db.Column(db.String(500), nullable=False)
    last_chapter = db.Column(db.String(50), default="Belum ada")
    
    # Relasi: Komik ini milik user siapa?
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)