#!/bin/bash

# Thư mục chứa các reference repositories
REFS_DIR="refs"

# Tạo thư mục refs nếu chưa tồn tại
mkdir -p "$REFS_DIR"

# Khai báo danh sách các repository: "tên_thư_mục|link_git"
# Bạn có thể dễ dàng thay đổi link Git bên dưới.
REPOS=(
  "A-mem|https://github.com/agiresearch/A-mem.git"
  "ECC|https://github.com/affaan-m/ECC.git"
  "MemOS|https://github.com/MemTensor/MemOS.git"
  "Memori|https://github.com/memorilabs/memori.git"
  "OpenViking|https://github.com/volcengine/OpenViking.git"
  "ReMe|https://github.com/agentscope-ai/ReMe.git"
  "RetainDB|https://github.com/RetainDB/RetainDB.git"
  "SimpleMem|https://github.com/aiming-lab/SimpleMem.git"
  "TencentDB-Agent-Memory|https://github.com/TencentCloud/TencentDB-Agent-Memory.git"
  "Understand-Anything|https://github.com/Egonex-AI/Understand-Anything.git"
  "agentmemory|https://github.com/rohitg00/agentmemory.git"
  "byterover-cli|https://github.com/campfirein/byterover-cli.git"
  "claude-mem|https://github.com/thedotmack/claude-mem.git"
  "cognee|https://github.com/topoteretes/cognee.git"
  "honcho|https://github.com/plastic-labs/honcho.git"
  "neural-memory|https://github.com/nhadaututtheky/neural-memory.git"
  "sqlite-ai|https://github.com/sqliteai/sqlite-ai.git"

  "hindsight|https://github.com/vectorize-io/hindsight.git"
  "icm|https://github.com/rtk-ai/icm.git"
  "letta-code|https://github.com/letta-ai/letta-code.git"
  "mem0|https://github.com/mem0ai/mem0.git"
  "memweave|https://github.com/sachinsharma9780/memweave.git"
  "retaindb-hermes|https://github.com/RetainDB/hermes.git"
  "superpowers|https://github.com/obra/superpowers.git"
  "zep|https://github.com/getzep/zep.git"
)

# Cấu hình Authorization Header nếu có biến môi trường GITHUB_TOKEN
AUTH_HEADER=()
if [ -n "$GITHUB_TOKEN" ]; then
  AUTH_HEADER=(-H "Authorization: token $GITHUB_TOKEN")
fi

# Hàm lấy số sao từ GitHub API
get_stars() {
  local repo_url="$1"
  local repo_path=$(echo "$repo_url" | sed -E 's|https://github.com/||' | sed -E 's|\.git$||')
  local response=$(curl -s "${AUTH_HEADER[@]}" "https://api.github.com/repos/$repo_path")
  local stars=""
  if command -v jq >/dev/null 2>&1; then
    stars=$(echo "$response" | jq '.stargazers_count' 2>/dev/null)
  else
    stars=$(echo "$response" | grep -o '"stargazers_count": [0-9]*' | head -n1 | cut -d' ' -f2)
  fi
  if [ -z "$stars" ] || [ "$stars" = "null" ]; then
    echo "N/A"
  else
    echo "$stars ⭐"
  fi
}

# Duyệt qua từng repo để clone hoặc pull
for item in "${REPOS[@]}"; do
  # Phân tách tên thư mục và URL
  DIR_NAME="${item%%|*}"
  REPO_URL="${item#*|}"
  
  TARGET_PATH="$REFS_DIR/$DIR_NAME"
  
  if [ "$REPO_URL" = "PLACEHOLDER_LINK_GIT" ] || [ -z "$REPO_URL" ]; then
    echo "========================================="
    echo "Processing: $DIR_NAME"
    echo "⚠️ Chưa cấu hình link Git cho $DIR_NAME. Bỏ qua."
    continue
  fi
  
  # Lấy số sao
  STARS=$(get_stars "$REPO_URL")
  
  echo "========================================="
  echo "Processing: $DIR_NAME ($STARS)"
  
  if [ -d "$TARGET_PATH" ]; then
    if [ -e "$TARGET_PATH/.git" ]; then
      echo "🔄 Đang cập nhật (pull) $DIR_NAME..."
      git -C "$TARGET_PATH" pull
    else
      echo "🧹 Thư mục $TARGET_PATH đã tồn tại nhưng không phải Git. Đang xóa và tải lại..."
      rm -rf "$TARGET_PATH"
      echo "📥 Đang tải (clone) $DIR_NAME..."
      git clone "$REPO_URL" "$TARGET_PATH"
    fi
  else
    echo "📥 Đang tải (clone) $DIR_NAME..."
    git clone "$REPO_URL" "$TARGET_PATH"
  fi
done

echo "========================================="
echo "Done!"
