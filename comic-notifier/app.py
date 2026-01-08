from flask import Flask
from models import db, User, Favorite
import os

app = Flask(__name__)

# Konfigurasi Database (Pakai SQLite dulu biar mudah di local)
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SECRET_KEY'] = 'kuncirahasia123' # Ganti nanti kalau deploy

# Hubungkan database dengan app
db.init_app(app)

# Route Test untuk memastikan app jalan
@app.route('/')
def index():
    return "<h1>Sistem Comic Notifier Siap! Database sudah aktif.</h1>"

if __name__ == '__main__':
    # Perintah ini akan membuat file database.db otomatis jika belum ada
    with app.app_context():
        db.create_all()
        print("Database berhasil dibuat!")
        
    app.run(debug=True)