---
chapter: 5
title: LINE連携
tier: paid
status: placeholder
---

# 第5章 LINE連携

> 【🔒 tier: 有料】Xポスト → LIFF → LINE OAuth → push 配信までの End-to-End を、LINE Harness と組み合わせて構築する完全フローを扱います。

## 章の目的
- X 上のキャンペーン参加者を、LINE 公式アカウントの push 配信対象まで一気通貫で移行できる
- LIFF URL パラメータ設計と OAuth 経由の UUID 確定の違いを使い分けられる
- 連携バッジ表示（IG/LINE Cross-Link 同等の X/LINE 連携）の仕組みを設計できる

## 想定読者
- LINE Harness を既に運用中、または導入予定の運用者
- X→LINE 送客で「友だち追加だけで終わってる」課題を持つマーケター

## 目次
- 5.1 X Harness × LINE Harness の連携アーキテクチャ
- 5.2 LIFF URL パラメータ設計（liffId / ref_code の引き回し）
- 5.3 LINE OAuth 経由で UUID を確定させる手順
- 5.4 push 配信対象タグの自動付与
- 5.5 X iOS in-app browser 問題の回避策（Universal Link）

## 前提
- 第4章のキャンペーン設計を読んでいること
- LINE Harness が稼働しており、LIFF ID と LINE Login チャネルを持っていること
- 参照: [`../LINE-HARNESS-INTEGRATION.md`](../LINE-HARNESS-INTEGRATION.md)

## 次の章
- [第6章 運用＆コスト管理](./06-operations-cost.md) 🔒 — 構築した E2E を「事故らせず」回し続けるための運用知識を扱います。

---
*このファイルはプレースホルダーです。本文は別セッションで執筆します。*
