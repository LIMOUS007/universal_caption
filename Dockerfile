FROM python:3.13-slim

RUN pip install --no-cache-dir uv

WORKDIR /app

# Install dependencies first (layer-cached until pyproject.toml changes)
COPY backend/pyproject.toml ./
RUN uv pip install --system --no-cache .

# Copy application source
COPY backend/ .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
