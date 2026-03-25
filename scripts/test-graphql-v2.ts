
import fs from 'fs';
import { setDeliveryAddress } from '../src/collector-node/sessionManager.js';
import { getNextCookies } from '../src/collector-node/cookieRotator.js';

async function testDirectGraphQL() {
    console.log("Starting GraphQL Feed Test...");
    
    // 1. Get cookies
    let cookies = getNextCookies() || "";
    if (!cookies) {
        console.log("No valid cookies found in accounts.json");
        return;
    }

    // 2. Bind address (Charleston, SC)
    console.log("Binding DMA to session...");
    const boundCookies = await setDeliveryAddress(32.7765, -79.9311, "Charleston", cookies);
    if (boundCookies) cookies = boundCookies;

    // 3. Build GraphQL Payload for offset 0
    const cursorObj = {
        "offset": 0,
        "vertical_ids": [],
        "cross_vertical_page_type": "GLOBAL_SEARCH_PAGE",
        "page_stack_trace": [],
        "layout_override": "UNSPECIFIED",
        "is_pagination_fallback": null,
        "source_page_type": null,
        "vertical_names": {}
    };
    
    const cursorB64 = Buffer.from(JSON.stringify(cursorObj)).toString('base64');

    const payload = {
        "operationName": "searchWithFilterFacetFeed",
        "variables": {
            "cursor": cursorB64,
            "filterQuery": "",
            "query": "restaurants",
            "isDebug": false,
            "searchType": ""
        },
        "query": `query searchWithFilterFacetFeed($cursor: String, $filterQuery: String, $query: String!, $isDebug: Boolean, $fromFilterChange: Boolean, $serializedBundleGlobalSearchContext: String, $address: String, $searchType: String) {
  searchWithFilterFacetFeed(
    cursor: $cursor
    filterQuery: $filterQuery
    query: $query
    isDebug: $isDebug
    fromFilterChange: $fromFilterChange
    serializedBundleGlobalSearchContext: $serializedBundleGlobalSearchContext
    address: $address
    searchType: $searchType
  ) {
    ...FacetFeedV2ResultFragment
    __typename
  }
}

fragment FacetFeedV2ResultFragment on FacetFeedV2Result {
  body {
    id
    header {
      ...FacetV2Fragment
      __typename
    }
    body {
      ...FacetV2Fragment
      __typename
    }
    layout {
      omitFooter
      __typename
    }
    __typename
  }
  page {
    ...FacetV2PageFragment
    __typename
  }
  header {
    ...FacetV2Fragment
    __typename
  }
  footer {
    ...FacetV2Fragment
    __typename
  }
  custom
  logging
  __typename
}

fragment FacetV2Fragment on FacetV2 {
  ...FacetV2BaseFragment
  childrenMap {
    ...FacetV2BaseFragment
    __typename
  }
  __typename
}

fragment FacetV2BaseFragment on FacetV2 {
  id
  childrenCount
  component {
    ...FacetV2ComponentFragment
    __typename
  }
  name
  text {
    ...FacetV2TextFragment
    __typename
  }
  images {
    main {
      ...FacetV2ImageFragment
      __typename
    }
    icon {
      ...FacetV2ImageFragment
      __typename
    }
    background {
      ...FacetV2ImageFragment
      __typename
    }
    accessory {
      ...FacetV2ImageFragment
      __typename
    }
    custom {
      key
      value {
        ...FacetV2ImageFragment
        __typename
      }
      __typename
    }
    __typename
  }
  events {
    click {
      name
      data
      __typename
    }
    __typename
  }
  style {
    spacing
    background_color
    border {
      color
      width
      style
      __typename
    }
    sizeClass
    dlsType
    __typename
  }
  layout {
    omitFooter
    gridSpecs {
      Mobile {
        ...FacetV2LayoutGridFragment
        __typename
      }
      Phablet {
        ...FacetV2LayoutGridFragment
        __typename
      }
      Tablet {
        ...FacetV2LayoutGridFragment
        __typename
      }
      Desktop {
        ...FacetV2LayoutGridFragment
        __typename
      }
      WideScreen {
        ...FacetV2LayoutGridFragment
        __typename
      }
      UltraWideScreen {
        ...FacetV2LayoutGridFragment
        __typename
      }
      __typename
    }
    dlsPadding {
      top
      right
      bottom
      left
      __typename
    }
    __typename
  }
  custom
  logging
  __typename
}

fragment FacetV2ComponentFragment on FacetV2Component {
  id
  category
  __typename
}

fragment FacetV2TextFragment on FacetV2Text {
  title
  titleTextAttributes {
    textStyle
    textColor
    __typename
  }
  subtitle
  subtitleTextAttributes {
    textStyle
    textColor
    __typename
  }
  accessory
  accessoryTextAttributes {
    textStyle
    textColor
    __typename
  }
  description
  descriptionTextAttributes {
    textStyle
    textColor
    __typename
  }
  custom {
    key
    value
    __typename
  }
  __typename
}

fragment FacetV2ImageFragment on FacetV2Image {
  uri
  videoUri
  placeholder
  local
  style
  logging
  events {
    click {
      name
      data
      __typename
    }
    __typename
  }
  __typename
}

fragment FacetV2LayoutGridFragment on FacetV2LayoutGrid {
  interRowSpacing
  interColumnSpacing
  minDimensionCount
  __typename
}

fragment FacetV2PageFragment on FacetV2Page {
  next {
    name
    data
    __typename
  }
  onLoad {
    name
    data
    __typename
  }
  __typename
}`
    };

    console.log("Sending GraphQL Search request...");
    const { gotScraping } = await import('got-scraping');
    const res = await gotScraping({
        url: "https://www.doordash.com/graphql/searchWithFilterFacetFeed",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Cookie": cookies,
            "Origin": "https://www.doordash.com",
            "Referer": "https://www.doordash.com/search/store/restaurants/"
        },
        body: JSON.stringify(payload),
        headerGeneratorOptions: { browsers: ['chrome'], os: ['macos', 'windows'] }
    });

    console.log(`HTTP ${res.statusCode}`);
    fs.writeFileSync('scripts/graphql-out.json', res.body);
    console.log("Saved raw output to scripts/graphql-out.json");
    
    if (res.statusCode === 200) {
        try {
            const data = JSON.parse(res.body);
            const stores = data.data?.searchWithFilterFacetFeed?.body?.flatMap((b: any) => b.body || []) || [];
            console.log(`Found ${stores.length} store facet nodes in GraphQL response!`);
        } catch(e) {
            console.log("Parse error:", e);
        }
    }
}

testDirectGraphQL();
