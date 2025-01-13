import { createStyles } from 'antd-style';

export const useStyle = createStyles(({ token, css }) => {
  return {
    layout: css`
      width: 100%;
      height: 100vh;
      border-radius: ${token.borderRadius}px;
      display: flex;
      background: ${token.colorBgContainer};
      font-family: AlibabaPuHuiTi, ${token.fontFamily}, sans-serif;
      overflow: hidden;
      position: relative;

      .ant-prompts {
        color: ${token.colorText};
      }

      @media (max-width: 1024px) {
        flex-direction: column;
      }
    `,
    menu: css`
      background: ${token.colorBgLayout}80;
      width: 280px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      transition: all 0.3s ease;
      position: relative;
      flex-shrink: 0;
      overflow: hidden;

      &.collapsed {
        width: 0;
        min-width: 0;
        padding: 0;
        margin: 0;
        opacity: 0;
        visibility: hidden;

        * {
          visibility: hidden;
        }
      }

      @media (max-width: 1024px) {
        width: 100%;
        height: auto;
        max-height: 60px;
        overflow: hidden;
        opacity: 1;
        visibility: visible;

        &.collapsed {
          opacity: 1;
          visibility: visible;
          width: 100%;
          * {
            visibility: visible;
          }
        }

        &.expanded {
          max-height: 100vh;
          height: 40vh;
        }
      }

      @media (max-width: 768px) {
        &.expanded {
          height: 70vh;
        }
      }
    `,
    conversations: css`
      padding: 0 12px;
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      min-width: 0;

      /* 隱藏 WebKit 瀏覽器的滾動條 */
      &::-webkit-scrollbar {
        display: none;
      }
      /* 隱藏 Firefox 瀏覽器的滾動條 */
      scrollbar-width: none;

      @media (max-width: 1024px) {
        max-height: calc(40vh - 140px);
      }

      @media (max-width: 768px) {
        max-height: calc(70vh - 140px);
      }
    `,
    chat: css`
      height: 100vh;
      width: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      padding: ${token.paddingLG}px;
      gap: 16px;
      overflow: hidden;
      transition: margin-left 0.3s ease;
      margin-left: 0;

      @media (max-width: 1024px) {
        padding: ${token.padding}px;
        height: calc(100vh - 60px);
        margin-left: 0 !important;
      }

      @media (max-width: 768px) {
        height: calc(100vh - 60px);
        padding: 12px;
        gap: 12px;

        .ant-prompts {
          .ant-space {
            gap: 8px !important;
          }
        }
      }

      &.menu-collapsed {
        margin-left: 0;
      }
    `,
    messages: css`
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      
      /* 隱藏 WebKit 瀏覽器的滾動條 */
      &::-webkit-scrollbar {
        display: none;
      }
      /* 隱藏 Firefox 瀏覽器的滾動條 */
      scrollbar-width: none;
    `,
    placeholder: css`
      padding-top: 32px;

      @media (max-width: 1024px) {
        padding-top: 16px;
      }

      @media (max-width: 768px) {
        padding-top: 8px;

        .ant-welcome {
          padding: 16px;
        }

        .ant-space {
          gap: 8px !important;
        }
      }
    `,
    sender: css`
      box-shadow: ${token.boxShadow};

      @media (max-width: 768px) {
        .ant-input {
          padding: 8px;
        }
      }
    `,
    logo: css`
      display: flex;
      height: 72px;
      align-items: center;
      justify-content: start;
      padding: 0 24px;
      box-sizing: border-box;
      min-width: 0;
      white-space: nowrap;

      img {
        width: 24px;
        height: 24px;
        display: inline-block;
        flex-shrink: 0;
      }

      span {
        display: inline-block;
        margin: 0 8px;
        font-weight: bold;
        color: ${token.colorText};
        font-size: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      @media (max-width: 1024px) {
        height: 60px;
        padding: 0 16px;
      }

      @media (max-width: 768px) {
        padding: 0 12px;
        height: 50px;
        
        span {
          font-size: 14px;
        }
      }
    `,
    addBtn: css`
      background: #1677ff0f;
      border: 1px solid #1677ff34;
      width: calc(100% - 24px);
      margin: 0 12px 24px 12px;
      min-width: 0;
      white-space: nowrap;

      @media (max-width: 1024px) {
        margin: 8px 12px;
      }

      @media (max-width: 768px) {
        margin: 4px 8px;
        height: 32px;
        font-size: 14px;
      }
    `,
    menuToggle: css`
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      left: 0;
      top: 12px;
      width: 36px;
      height: 36px;
      border-radius: 0 4px 4px 0;
      background: ${token.colorBgContainer};
      cursor: pointer;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;

      &.collapsed {
        left: 0;
      }

      &.expanded {
        left: 280px;
      }

      @media (max-width: 1024px) {
        position: absolute;
        right: 16px;
        left: auto;
        top: 12px;
        border-radius: 50%;

        &.collapsed, &.expanded {
          left: auto;
        }
      }

      @media (max-width: 768px) {
        width: 32px;
        height: 32px;
        top: 8px;
        right: 12px;
      }
    `,
  };
}); 