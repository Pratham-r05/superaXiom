# ArXiv paper fetching functionality

import time
import requests
import xml.etree.ElementTree as ET
import streamlit as st


@st.cache_data(ttl=86400)                          
def fetch_arxiv_papers():
    all_papers = {}
    for start in range(0, 500, 100):
        time.sleep(3)
        url = "https://export.arxiv.org/api/query"
        params = {
            "search_query": "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": 100,
            "start": start
        }
        response = requests.get(url, params=params)
        if response.status_code != 200:
            break
        root = ET.fromstring(response.content)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = entry.find("atom:title", ns).text.strip().replace("\n", " ")
            abstract = entry.find("atom:summary", ns).text.strip().replace("\n", " ")
            raw_id = entry.find("atom:id", ns).text.strip()
            arxiv_id = raw_id.split("/abs/")[-1].split("v")[0]
            all_papers[title] = {
                "abstract": abstract,
                "arxiv_id": arxiv_id
            }
    return all_papers
