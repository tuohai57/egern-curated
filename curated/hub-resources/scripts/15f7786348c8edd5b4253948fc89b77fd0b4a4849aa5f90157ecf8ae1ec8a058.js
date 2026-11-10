/*
Original author: app2smile
Source: https://raw.githubusercontent.com/app2smile/rules/master/js/bilibili-json.js
Egern adaptation: ErrBin
License: MIT

用法
在 Egern 模块的 scriptings 中配置此脚本，script_url 指向转换后文件。
匹配规则、脚本阶段、正文读取和 MITM 域名以配套 Egern 模块为准。
*/


export default async function(ctx) {
  const responseBody = ctx.response?.body == null ? undefined : await ctx.response.text();
  const url = ctx.request.url;
  const method = ctx.request.method;
  const notifyTitle = "bilibili-json";
  console.log(`b站json-2023.10.22`);
  if (!responseBody) {
    // 有undefined的情况
    console.log(`$response.body为undefined:${url}`);
    return {};
  }
  if (method !== "GET") {
    ctx.notify({
      title: notifyTitle,
      subtitle: "method错误:",
      body: method
    });
  }
  let body = JSON.parse(responseBody);
  if (!body.data) {
    console.log(url);
    console.log(`body:${responseBody}`);
    ctx.notify({
      title: notifyTitle,
      subtitle: url,
      body: "data字段错误"
    });
  } else {
    if (url.includes("x/v2/splash")) {
      console.log('开屏页' + (url.includes("splash/show") ? 'show' : 'list'));
      if (!body.data.show) {
        // 有时候返回的数据没有show字段
        console.log('数据无show字段');
      } else {
        delete body.data.show;
        console.log('成功');
      }
    } else if (url.includes("resource/show/tab/v2")) {
      console.log('tab修改');
      // 顶部右上角
      if (!body.data.top) {
        console.log(`body:${responseBody}`);
        ctx.notify({
          title: notifyTitle,
          subtitle: 'tab',
          body: "top字段错误"
        });
      } else {
        body.data.top = body.data.top.filter(item => {
          if (item.name === '游戏中心') {
            console.log('去除右上角游戏中心');
            return false;
          }
          return true;
        });
        fixPos(body.data.top);
      }
      // 底部tab栏
      if (!body.data.bottom) {
        console.log(`body:${responseBody}`);
        ctx.notify({
          title: notifyTitle,
          subtitle: 'tab',
          body: "bottom字段错误"
        });
      } else {
        body.data.bottom = body.data.bottom.filter(item => {
          if (item.name === '发布') {
            console.log('去除发布');
            return false;
          } else if (item.name === '会员购' || item.tab_id === '会员购Bottom') {
            console.log('去除会员购');
            return false;
          }
          return true;
        });
        fixPos(body.data.bottom);
      }
    } else if (url.includes("x/v2/feed/index")) {
      console.log('推荐页');
      if (!body.data.items?.length) {
        console.log(`body:${responseBody}`);
        ctx.notify({
          title: notifyTitle,
          subtitle: '推荐页',
          body: "items字段错误"
        });
      } else {
        body.data.items = body.data.items.filter(i => {
          const {
            card_type: cardType,
            card_goto: cardGoto
          } = i;
          if (cardType && cardGoto) {
            if (cardType === 'banner_v8' && cardGoto === 'banner') {
              if (!i.banner_item) {
                console.log(`body:${responseBody}`);
                ctx.notify({
                  title: notifyTitle,
                  subtitle: '推荐页',
                  body: "banner_item错误"
                });
              } else {
                for (const v of i.banner_item) {
                  if (!v.type) {
                    console.log(`body:${responseBody}`);
                    ctx.notify({
                      title: notifyTitle,
                      subtitle: '推荐页',
                      body: "type错误"
                    });
                  } else {
                    if (v.type === 'ad') {
                      console.log('banner广告');
                      return false;
                    }
                  }
                }
              }
            } else if (cardType === 'cm_v2' && ['ad_web_s', 'ad_av', 'ad_web_gif',
                'ad_player', 'ad_inline_3d', 'ad_inline_eggs'
              ].includes(cardGoto)) {
              // ad_player大视频广告 ad_web_gif大gif广告 ad_web_s普通小广告 ad_av创作推广广告 ad_inline_3d  上方大的视频3d广告 ad_inline_eggs 上方大的视频广告
              console.log(`${cardGoto}广告去除)`);
              return false;
            } else if (cardType === 'small_cover_v10' && cardGoto === 'game') {
              console.log('游戏广告去除');
              return false;
            } else if (cardType === 'cm_double_v9' && cardGoto === 'ad_inline_av') {
              console.log('创作推广-大视频广告');
              return false;
            }
          } else {
            console.log(`body:${responseBody}`);
            ctx.notify({
              title: notifyTitle,
              subtitle: '推荐页',
              body: "无card_type/card_goto"
            });
          }
          return true;
        });
      }
    } else {
      ctx.notify({
        title: notifyTitle,
        subtitle: "路径匹配错误:",
        body: url
      });
    }
  }
  body = JSON.stringify(body);
  return {
    body: body
  };

  function fixPos(arr) {
    for (let i = 0; i < arr.length; i++) {
      // 修复pos
      arr[i].pos = i + 1;
    }
  }
  throw new Error("Script ended without a completion result");
}
