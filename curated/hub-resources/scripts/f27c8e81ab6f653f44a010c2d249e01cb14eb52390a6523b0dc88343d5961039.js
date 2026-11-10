/*
Original author: app2smile
Source: https://raw.githubusercontent.com/app2smile/rules/master/js/zhihu.js
Egern adaptation: ErrBin
License: MIT

用法
配套模块：https://egern.pages.dev/modules/app2smile/rules/module/zhihu.yaml
将此地址添加到 Egern 模块并启用。以下为该模块中本脚本的配置，无需重复添加：

scriptings:
- http_response:
    name: 知乎json
    script_url: https://egern.pages.dev/scripts/app2smile/rules/js/zhihu.js
    match: ^https:\/\/(appcloud2\.zhihu\.com\/v3\/config$|www\.zhihu\.com\/api\/v4\/(answers\/\d+\/recommendations|articles\/\d+\/recommendation)|api\.zhihu\.com\/(topstory\/recommend|commercial_api\/(real_time_launch_v2|app_float_layer$)|questions\/\d+\/feeds\?|v4\/questions\/\d+\/answers\?))
    body_required: true
    max_size: 16777216
mitm:
  hostnames:
    includes:
    - api.zhihu.com
    - www.zhihu.com
    - appcloud2.zhihu.com
    excludes: []
*/


export default async function(ctx) {
  const responseBody = ctx.response?.body == null ? undefined : await ctx.response.text();
  const url = ctx.request.url;
  const method = ctx.request.method;
  if (!responseBody) {
    console.log(`$response.body为undefined:${url}`);
    return {};
  }
  console.log(`2022-12.6`);
  const noticeTitle = "知乎去广告脚本错误";
  let body = JSON.parse(responseBody);
  if (method !== "GET") {
    console.log(url);
    ctx.notify({
      title: noticeTitle,
      subtitle: "method错误:",
      body: method
    });
  }
  if (url.includes("api.zhihu.com/commercial_api/real_time_launch_v2")) {
    console.log('知乎-开屏页');
    if (!body.launch) {
      console.log(`body:${responseBody}`);
      ctx.notify({
        title: noticeTitle,
        subtitle: name,
        body: "launch字段为空"
      });
    }
    let launch = JSON.parse(body.launch);
    if (!launch.ads) {
      // ads字段有时候为空,有时候没有ads字段
      console.log(`body:${responseBody}`);
      // $notification.post(noticeTitle, name, "launch-ads字段为空");
    } else {
      launch.ads = [];
      console.log('成功');
    }
    body.launch = JSON.stringify(launch);
  } else if (url.includes("api.zhihu.com/topstory/recommend")) {
    console.log('知乎-推荐列表');
    let dataArr = body.data;
    if (!dataArr) {
      console.log(`body:${responseBody}`);
      ctx.notify({
        title: noticeTitle,
        subtitle: "知乎推荐",
        body: "data字段为空"
      });
    } else {
      body.data = dataArr.filter(item => {
        if (item.extra?.type === "zvideo") {
          let videoUrl = item.common_card.feed_content.video.customized_page_url;
          let videoID = getUrlParamValue(videoUrl, "videoID");
          if (!videoID) {
            console.log('zvideo未获取到videoID');
            console.log(`body:${responseBody}`);
            // 部分获取不到videoId并且视频可以播放
          } else {
            console.log(
              `videoID处理成功,原始:${item.common_card.feed_content.video.id},修改为:${videoID}`);
            item.common_card.feed_content.video.id = videoID;
          }
        } else if (item.type === 'market_card' && item.fields?.header?.url && item.fields.body
          ?.video?.id) {
          let videoID = getUrlParamValue(item.fields.header.url, "videoID");
          if (!videoID) {
            console.log(`body:${responseBody}`);
            ctx.notify({
              title: noticeTitle,
              subtitle: "知乎推荐列表视频",
              body: "videoID获取错误"
            });
          } else {
            console.log(
              `market_card-videoID处理成功,原始:${item.fields.body.video.id},修改为:${videoID}`);
            item.fields.body.video.id = videoID;
          }
        } else if (item.common_card?.feed_content?.video?.id) {
          let str = responseBody.substring(responseBody.indexOf(
              "\"feed_content\":{\"video\":{\"id\":") +
            "\"feed_content\":{\"video\":{\"id\":".length);
          let videoID = str.substring(0, str.indexOf(','));
          console.log(
            `其他-videoID处理成功,原始:${item.common_card.feed_content.video.id},修改为:${videoID}`);
          item.common_card.feed_content.video.id = videoID;
        }
        return item.type !== 'feed_advert';
      });
      if (body.data.length === dataArr.length) {
        console.log('列表数据无广告');
      } else {
        console.log('成功');
      }
    }
  } else if (url.includes("api.zhihu.com/questions") || url.includes(
    "api.zhihu.com/v4/questions")) {
    if (url.includes("v4/questions")) {
      console.log('v4/questions');
    } else {
      console.log('questions');
    }
    console.log('知乎-问题回答列表');
    if (!body.data.ad_info && !body.ad_info) {
      // 个别问题回答列表无广告
      console.log("问题回答列表无广告");
    } else {
      body.data.ad_info = null;
      body.ad_info = null;
      console.log('成功');
    }
  } else if (url.includes("www.zhihu.com/api/v4/answers")) {
    console.log('知乎-回答下的广告');
    if (!body.paging || !body.data) {
      console.log(`body:${responseBody}`);
      ctx.notify({
        title: noticeTitle,
        subtitle: '知乎回答下广告',
        body: "paging/data字段为空"
      });
    } else {
      body.paging = null;
      body.data = null;
      console.log('成功');
    }
  } else if (url.includes("www.zhihu.com/api/v4/articles/")) {
    console.log('知乎-文章articles回答下广告');
    if (!body.ad_info) {
      console.log(`body:${responseBody}`);
      ctx.notify({
        title: noticeTitle,
        subtitle: name,
        body: "articles-ad_info字段为undefined"
      });
    } else {
      body.ad_info = null;
      console.log('成功');
    }
  } else if (url.includes("appcloud2.zhihu.com/v3/config")) {
    console.log('知乎-appcloud2 config配置');
    if (body.config?.zhcnh_thread_sync?.ZHBackUpIP_Switch_Open === '1') {
      body.config.zhcnh_thread_sync.ZHBackUpIP_Switch_Open = '0';
      console.log('ZHBackUpIP_Switch_Open改为0');
    } else {
      console.log('无需更改ZHBackUpIP_Switch_Open');
      console.log(`body:${responseBody}`);
    }
  } else if (url.includes("api.zhihu.com/commercial_api/app_float_layer")) {
    console.log('知乎-首页右下角悬浮框');
    if ('feed_egg' in body) {
      console.log('成功');
      body = {};
    } else {
      console.log('无需处理');
    }
  } else {
    ctx.notify({
      title: noticeTitle,
      subtitle: "路径匹配错误:",
      body: url
    });
  }
  body = JSON.stringify(body);
  return {
    body: body
  };

  function getUrlParamValue(url, queryName) {
    return Object.fromEntries(url.substring(url.indexOf("?") + 1)
      .split("&")
      .map(pair => pair.split("="))
    )["videoID"];
  }
  throw new Error("Script ended without a completion result");
}
