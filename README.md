# egern-curated

`tuohai57/egern-mirror` 的拆分子仓库之一，只为绕开 jsDelivr 的 50 MB 单仓库上限。

## 内容

- `curated/` —— 18 个文件

## 用法

```
https://cdn.jsdelivr.net/gh/tuohai57/egern-curated@main/<路径>
```

仓库内保留了原来的完整目录结构，所以和 `egern-mirror` 的路径一一对应，
只是把 URL 里的仓库名换掉即可。

## 注意

- 只放配置里**真正引用**的文件，没用的不往这放，保持体积小
- 这是镜像/自建文件，不是上游；上游更新要回 `egern-mirror` 重新生成
