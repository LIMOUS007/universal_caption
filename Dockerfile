FROM python:3.13-slim

RUN pip install --no-cache-dir uv

WORKDIR /universal_caption

COPY pyproject.toml ./
COPY uv.lock ./

ENV UV_PROJECT_ENVIRONMENT=/usr/local

RUN uv sync 

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]