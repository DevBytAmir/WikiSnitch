# Retrieval benchmark

Questions: MariaDB's 37-question Finland history set. A hit is any language version with the expected `wikidata_id`.

Three searches. **article**: MariaDB's one vector per article over all 29,460 articles. **article, same articles**: the same article vectors, but only over the articles that have paragraph vectors. **paragraph**: our paragraph vectors.

Paragraph vectors cover 29,417 of 29,460 articles. Compare **paragraph** with **article, same articles**; the full **article** row searches a larger and harder space.

| Language | Method | Questions | hit@1 | hit@5 | hit@10 | MRR |
|---|---|---:|---:|---:|---:|---:|
| all | article | 37 | 57% | 76% | 89% | 0.65 |
| all | article, same articles | 37 | 57% | 76% | 89% | 0.65 |
| all | paragraph | 37 | 49% | 70% | 86% | 0.60 |
| en | article | 13 | 54% | 69% | 85% | 0.62 |
| en | article, same articles | 13 | 54% | 69% | 85% | 0.62 |
| en | paragraph | 13 | 54% | 85% | 100% | 0.72 |
| sv | article | 11 | 82% | 82% | 100% | 0.84 |
| sv | article, same articles | 11 | 82% | 82% | 100% | 0.84 |
| sv | paragraph | 11 | 55% | 82% | 91% | 0.66 |
| fi | article | 13 | 38% | 77% | 85% | 0.53 |
| fi | article, same articles | 13 | 38% | 77% | 85% | 0.53 |
| fi | paragraph | 13 | 38% | 46% | 69% | 0.43 |

The 5th percentile of the similarity of successful paragraph matches is `0.549`. The configured `ask_min` is `0.522` (left unchanged).
