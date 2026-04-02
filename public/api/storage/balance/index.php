<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Allow local dev (localhost) to use the same server storage.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Wardrone-Key');

if ($method === 'OPTIONS') {
  http_response_code(204);
  exit;
}

// Store data outside the API directory to avoid accidental deploy overwrites.
// This path is inside /wardrone on the server, so it stays with the site.
$dataDir = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'data';
$dataFile = $dataDir . DIRECTORY_SEPARATOR . 'balance.json';
$backupDir = $dataDir . DIRECTORY_SEPARATOR . 'backups';
$adminKeyFile = $dataDir . DIRECTORY_SEPARATOR . 'admin.key';

function readAdminKey(string $path): ?string {
  if (!file_exists($path)) return null;
  $raw = file_get_contents($path);
  if ($raw === false) return null;
  $key = trim($raw);
  return $key !== '' ? $key : null;
}

function getProvidedKey(): ?string {
  // Header is preferred.
  $hdr = $_SERVER['HTTP_X_WARDRONE_KEY'] ?? null;
  if (is_string($hdr) && trim($hdr) !== '') return trim($hdr);
  // Fallback: query parameter (useful for manual testing).
  $q = $_GET['key'] ?? null;
  if (is_string($q) && trim($q) !== '') return trim($q);
  return null;
}

function ensureDir(string $dir): void {
  if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
  }
}

function readJsonFile(string $path): ?array {
  if (!file_exists($path)) return null;
  $raw = file_get_contents($path);
  if ($raw === false) return null;
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) return null;
  return $decoded;
}

function respond(int $code, array $payload): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

if ($method === 'GET') {
  $data = readJsonFile($dataFile);
  if ($data === null) {
    // Treat missing data as an empty state (first launch).
    // Returning 200 avoids the client falling back to unrelated local snapshots.
    respond(200, []);
  }
  respond(200, $data);
}

if ($method === 'POST') {
  // Protect writes with a simple admin key stored on the server (not in git).
  $expectedKey = readAdminKey($adminKeyFile);
  if ($expectedKey === null) {
    respond(500, ['error' => 'admin_key_not_configured']);
  }
  $provided = getProvidedKey();
  if ($provided === null || !hash_equals($expectedKey, $provided)) {
    respond(401, ['error' => 'unauthorized']);
  }

  $raw = file_get_contents('php://input');
  if ($raw === false) {
    respond(400, ['error' => 'no_body']);
  }
  // Simple size guard (2MB) to avoid abuse / misclicks.
  if (strlen($raw) > 2 * 1024 * 1024) {
    respond(413, ['error' => 'payload_too_large']);
  }
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    respond(400, ['error' => 'invalid_json']);
  }

  ensureDir($dataDir);
  ensureDir($backupDir);

  $decoded['updatedAt'] = gmdate('c');
  $encoded = json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if ($encoded === false) {
    respond(400, ['error' => 'encode_failed']);
  }

  $fp = fopen($dataFile, 'c+');
  if ($fp === false) {
    respond(500, ['error' => 'open_failed']);
  }
  if (!flock($fp, LOCK_EX)) {
    fclose($fp);
    respond(500, ['error' => 'lock_failed']);
  }
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, $encoded);
  fflush($fp);
  flock($fp, LOCK_UN);
  fclose($fp);

  $backupName = 'balance-' . time() . '.json';
  @file_put_contents($backupDir . DIRECTORY_SEPARATOR . $backupName, $encoded);

  respond(200, ['ok' => true]);
}

respond(405, ['error' => 'method_not_allowed']);

