<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) === $host) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$configPath = __DIR__ . '/config.local.php';
if (!is_readable($configPath)) {
  http_response_code(503);
  echo json_encode(['error' => 'config_missing', 'hint' => 'Создайте admin/config.local.php из config.example.php'], JSON_UNESCAPED_UNICODE);
  exit;
}

/** @var array{adminToken: string} $cfg */
$cfg = require $configPath;
$token = $cfg['adminToken'] ?? '';
if ($token === '' || $token === 'замените_на_случайную_строку_32plus_символов') {
  http_response_code(503);
  echo json_encode(['error' => 'token_not_configured'], JSON_UNESCAPED_UNICODE);
  exit;
}

$dataFile = dirname(__DIR__) . '/data/projects.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $hdr = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (!hash_equals($token, $hdr)) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  if (!is_readable($dataFile)) {
    http_response_code(404);
    echo json_encode(['error' => 'not_found'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  readfile($dataFile);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'method_not_allowed'], JSON_UNESCAPED_UNICODE);
  exit;
}

$hdr = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
if (!hash_equals($token, $hdr)) {
  http_response_code(403);
  echo json_encode(['error' => 'forbidden'], JSON_UNESCAPED_UNICODE);
  exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
  http_response_code(400);
  echo json_encode(['error' => 'empty_body'], JSON_UNESCAPED_UNICODE);
  exit;
}

$decoded = json_decode($raw, true);
if (!is_array($decoded) || json_last_error() !== JSON_ERROR_NONE) {
  http_response_code(400);
  echo json_encode(['error' => 'invalid_json'], JSON_UNESCAPED_UNICODE);
  exit;
}

if (!isset($decoded['projects']) || !is_array($decoded['projects'])) {
  http_response_code(400);
  echo json_encode(['error' => 'projects_required'], JSON_UNESCAPED_UNICODE);
  exit;
}

$dir = dirname($dataFile);
if (!is_dir($dir)) {
  if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
    http_response_code(500);
    echo json_encode(['error' => 'mkdir_failed'], JSON_UNESCAPED_UNICODE);
    exit;
  }
}

$pretty = json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
if ($pretty === false) {
  http_response_code(500);
  echo json_encode(['error' => 'encode_failed'], JSON_UNESCAPED_UNICODE);
  exit;
}

if (file_put_contents($dataFile, $pretty . "\n") === false) {
  http_response_code(500);
  echo json_encode(['error' => 'write_failed'], JSON_UNESCAPED_UNICODE);
  exit;
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
