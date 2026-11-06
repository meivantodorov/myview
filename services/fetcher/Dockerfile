# Използваме лека версия на Python
FROM python:3.11-slim

# Задаваме работна директория вътре в контейнера
WORKDIR /app

# Копираме само requirements първо (за по-бързо кеширане)
COPY requirements.txt .

# Инсталираме зависимостите
RUN pip install --no-cache-dir -r requirements.txt

# Копираме останалия код
COPY . .

# Казваме на Python да не буферира изхода
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8

# Стартираме сървиза (без reload, защото Docker сам ще се грижи за рестартите)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--http", "h11"]