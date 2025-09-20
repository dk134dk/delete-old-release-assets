const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    // 获取输入参数
    const tagNamesInput = core.getInput('tag_names', { required: true });
    const keepDaysAssets = parseInt(core.getInput('keep_days_assets') || '30');
    const token = core.getInput('token', { required: true });
    const dryRun = core.getInput('dry_run') === 'true';

    // 解析多个 tag 名称（支持逗号分隔）
    const tagNames = tagNamesInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    
    if (tagNames.length === 0) {
      core.setFailed('No valid tag names provided');
      return;
    }

    core.info(`Processing tags: ${tagNames.join(', ')}`);
    core.info(`Keeping assets newer than: ${keepDaysAssets} days`);

    // 创建 GitHub API 客户端
    const octokit = github.getOctokit(token);
    const context = github.context;

    // 获取仓库信息
    const [owner, repo] = context.payload.repository.full_name.split('/');

    // 计算截止日期
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDaysAssets);
    
    core.info(`Deleting assets older than: ${cutoffDate.toISOString()}`);

    let totalAssetsDeleted = 0;
    let totalAssetsConsidered = 0;

    // 处理每个 tag
    for (const tagName of tagNames) {
      core.info(`\nProcessing tag: ${tagName}`);
      
      // 获取指定 tag 的 release
      let release;
      try {
        const response = await octokit.rest.repos.getReleaseByTag({
          owner,
          repo,
          tag: tagName
        });
        release = response.data;
        core.info(`Found release: ${release.name} (ID: ${release.id})`);
      } catch (error) {
        core.warning(`Release with tag ${tagName} not found: ${error.message}`);
        continue;
      }

      // 获取 release 的所有资源
      let assets;
      try {
        assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
          owner,
          repo,
          release_id: release.id
        });
        core.info(`Found ${assets.length} assets in release`);
      } catch (error) {
        core.error(`Error listing assets for release ${tagName}: ${error.message}`);
        continue;
      }

      totalAssetsConsidered += assets.length;

      // 筛选需要删除的资源（创建时间早于截止日期）
      const assetsToDelete = assets.filter(asset => {
        const createdAt = new Date(asset.created_at);
        return createdAt < cutoffDate;
      });

      core.info(`Found ${assetsToDelete.length} assets older than ${keepDaysAssets} days`);

      if (assetsToDelete.length === 0) {
        core.info('No assets to delete for this release');
        continue;
      }

      // 删除或列出资源
      for (const asset of assetsToDelete) {
        if (dryRun) {
          core.info(`[DRY RUN] Would delete: ${asset.name} (ID: ${asset.id}, Created: ${asset.created_at})`);
        } else {
          core.info(`Deleting: ${asset.name} (ID: ${asset.id}, Created: ${asset.created_at})`);
          try {
            await octokit.rest.repos.deleteReleaseAsset({
              owner,
              repo,
              asset_id: asset.id
            });
            core.info(`Successfully deleted: ${asset.name}`);
            totalAssetsDeleted++;
          } catch (error) {
            core.error(`Failed to delete asset ${asset.name}: ${error.message}`);
          }
        }
      }
    }

    if (dryRun) {
      core.info(`\nProcess completed. ${totalAssetsConsidered} assets considered, ${totalAssetsDeleted} would be deleted (dry run).`);
    } else {
      core.info(`\nProcess completed. ${totalAssetsConsidered} assets considered, ${totalAssetsDeleted} assets deleted successfully.`);
    }

  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

run();
