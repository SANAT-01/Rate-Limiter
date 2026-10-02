# limiter — fixed-window rate limiter. Standard library only — no pip install, so the
# build needs no PyPI access; only the python:3.12-alpine base is pulled (via the
# registry mirror).
FROM python:3.12-alpine

WORKDIR /app
COPY limiter.py /app/limiter.py

EXPOSE 9000
CMD ["python", "/app/limiter.py"]
